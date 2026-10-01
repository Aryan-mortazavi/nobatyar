"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { audit, getSession, requireWorkspace } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { fieldErrors, locationSchema, packagePurchaseSchema, packageSchema } from "@/lib/validators";
import type { FormState } from "@/lib/form-state";
import { sellPackage, totalSessionsOf } from "@/lib/packages";
import { notify } from "@/lib/notifications";

export async function savePackageAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale);

  const lines = formData
    .getAll("serviceId")
    .map((serviceId, index) => ({
      serviceId: String(serviceId),
      quantity: Number(formData.getAll("quantity")[index] ?? 1),
    }))
    .filter((line) => line.serviceId);

  const parsed = packageSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    nameFa: formData.get("nameFa") ?? "",
    description: formData.get("description") ?? "",
    priceAmount: formData.get("priceAmount"),
    validDays: formData.get("validDays") ?? 90,
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    isPublic: formData.get("isPublic") === "on" || formData.get("isPublic") === "true",
    lines,
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const data = {
    name: input.name,
    nameFa: input.nameFa || null,
    description: input.description || null,
    priceAmount: input.priceAmount,
    validDays: input.validDays,
    isActive: input.isActive,
    isPublic: input.isPublic,
  };

  let packageId = input.id;
  if (!packageId) {
    let slug = slugify(input.name) || "package";
    let counter = 2;
    while (await prisma.package.findFirst({ where: { slug }, select: { id: true } })) {
      slug = `${slugify(input.name)}-${counter++}`;
    }
    packageId = (
      await prisma.package.create({
        data: { ...data, slug, workspaceId: workspace.id },
        select: { id: true },
      })
    ).id;
  } else {
    await prisma.package.update({ where: { id: packageId }, data });
  }

  await prisma.packageService.deleteMany({ where: { packageId } });
  await prisma.packageService.createMany({
    data: input.lines.map((line) => ({ packageId, ...line })),
  });

  await audit({
    action: input.id ? "PACKAGE_UPDATE" : "PACKAGE_CREATE",
    workspaceId: workspace.id,
    entity: "package",
    entityId: packageId,
    actorUserId: session.sub,
  });

  revalidatePath(`/${locale}/dashboard`, "layout");
  revalidatePath(`/${locale}/packages`, "layout");
  return { ok: true, id: packageId };
}

export async function deletePackageAction(packageId: string, locale: string): Promise<FormState> {
  const { workspace } = await requireWorkspace(locale, ["OWNER", "ADMIN"]);
  const sold = await prisma.packagePurchase.count({ where: { packageId } });
  if (sold > 0) {
    await prisma.package.update({ where: { id: packageId }, data: { isActive: false } });
    return { ok: true };
  }
  void workspace;
  await prisma.package.delete({ where: { id: packageId } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

/** Record a package sale (paid offline, tracked here). */
export async function sellPackageAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale);

  const parsed = packagePurchaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const pkg = await prisma.package.findUniqueOrThrow({
    where: { id: parsed.data.packageId },
    include: { services: true },
  });

  const purchase = await sellPackage({
    workspaceId: workspace.id,
    packageId: pkg.id,
    customerUserId: parsed.data.customerUserId || null,
    customerName: parsed.data.customerName,
    customerEmail: parsed.data.customerEmail || null,
    customerPhone: parsed.data.customerPhone,
    amountPaid: parsed.data.amountPaid,
  });

  await notify({
    workspaceId: workspace.id,
    userId: purchase.customerUserId,
    kind: "package_purchased",
    subject: `${workspace.name} — package`,
    message:
      (parsed.data.locale === "fa" ? "بسته شما ثبت شد" : "Your package is ready") +
      `\n${pkg.nameFa ?? pkg.name} · ${totalSessionsOf(pkg)} sessions`,
    to: { email: purchase.customerEmail, phone: purchase.customerPhone },
  });

  await audit({
    action: "PACKAGE_SELL",
    workspaceId: workspace.id,
    entity: "packagePurchase",
    entityId: purchase.id,
    meta: { packageId: pkg.id, amount: parsed.data.amountPaid },
    actorUserId: session.sub,
  });

  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true, id: purchase.id };
}

export async function saveLocationAction(
  _prev: FormState | null,
  formData: FormData,
): Promise<FormState> {
  const locale = String(formData.get("locale") ?? "fa");
  const { session, workspace } = await requireWorkspace(locale);

  const parsed = locationSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    nameFa: formData.get("nameFa") ?? "",
    address: formData.get("address") ?? "",
    phone: formData.get("phone") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    serviceIds: formData.getAll("serviceIds"),
    staffIds: formData.getAll("staffIds"),
  });
  if (!parsed.success) {
    return { ok: false, error: "VALIDATION", fields: fieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const data = {
    name: input.name,
    nameFa: input.nameFa || null,
    address: input.address || null,
    phone: input.phone || null,
    isActive: input.isActive,
  };

  let locationId = input.id;
  if (!locationId) {
    let slug = slugify(input.name) || "location";
    let counter = 2;
    while (await prisma.location.findFirst({ where: { slug }, select: { id: true } })) {
      slug = `${slugify(input.name)}-${counter++}`;
    }
    locationId = (
      await prisma.location.create({
        data: { ...data, slug, workspaceId: workspace.id },
        select: { id: true },
      })
    ).id;
  } else {
    await prisma.location.update({ where: { id: locationId }, data });
  }

  await prisma.locationService.deleteMany({ where: { locationId } });
  await prisma.locationService.createMany({
    data: input.serviceIds.map((serviceId) => ({ locationId, serviceId })),
  });
  await prisma.staffLocation.deleteMany({ where: { locationId } });
  await prisma.staffLocation.createMany({
    data: input.staffIds.map((staffId) => ({ locationId, staffId })),
  });

  await audit({
    action: input.id ? "LOCATION_UPDATE" : "LOCATION_CREATE",
    workspaceId: workspace.id,
    entity: "location",
    entityId: locationId,
    actorUserId: session.sub,
  });

  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true, id: locationId };
}

export async function removeLocationAction(id: string, locale: string): Promise<FormState> {
  await requireWorkspace(locale, ["OWNER", "ADMIN"]);
  await prisma.location.delete({ where: { id } });
  revalidatePath(`/${locale}/dashboard`, "layout");
  return { ok: true };
}

export { getSession };
