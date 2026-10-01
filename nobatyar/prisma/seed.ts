/**
 * Demo data for NobatYar.
 *
 * Creates one realistic business (a health & beauty centre) with services,
 * specialists, weekly schedules, time off, a holiday and a full booking
 * history, so the dashboard and the charts have something to show.
 *
 *   npm run db:seed            # (re)create everything
 *   npm run db:reset           # wipe the database first
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { addDays, zonedMinuteToUtc, type CivilDate } from "../src/lib/dates";

const prisma = new PrismaClient();

const TIMEZONE = "Asia/Tehran";
const DEFAULT_PASSWORD = "Nobat#2026";

// ── deterministic pseudo random (a demo must look the same twice) ───────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260930);
const pickOne = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const chance = (p: number) => rand() < p;

const MIN = 60_000;

function todayCivil(): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function at(date: CivilDate, minuteOfDay: number): Date {
  return zonedMinuteToUtc(date, minuteOfDay, TIMEZONE);
}

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i += 1) out += alphabet[Math.floor(rand() * alphabet.length)];
  return `APT-${out}`;
}

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.packagePurchase.deleteMany();
  await prisma.packageService.deleteMany();
  await prisma.package.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.timeOff.deleteMany();
  await prisma.workingHour.deleteMany();
  await prisma.staffLocation.deleteMany();
  await prisma.staffService.deleteMany();
  await prisma.locationService.deleteMany();
  await prisma.location.deleteMany();
  await prisma.service.deleteMany();
  await prisma.category.deleteMany();
  await prisma.staffMember.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await wipe();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  // ── Workspace ────────────────────────────────────────────────────────────
  const workspace = await prisma.workspace.create({
    data: {
      slug: "aria",
      name: "Aria Health & Beauty",
      nameFa: "مرکز درمان و زیبایی آریا",
      tagline: "زیبایی، با نگاهی علمی",
      description:
        "مرکز تخصصی مراقبت پوست و مو با بیش از ۱۰ سال سابقه؛ نوبت‌دهی آنلاین، یادآوری خودکار و پیگیری کد رهگیری.",
      accentColor: "#7c3aed",
      timezone: TIMEZONE,
      weekStart: 6, // Saturday
      defaultLocale: "fa",
      currency: "IRT",
      phone: "۰۲۱-۸۸۴۴۲۲۱۱",
      email: "info@aria-salon.example",
      address: "تهران، خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۱۲۰",
      minNoticeMinutes: 120,
      maxAdvanceDays: 60,
      slotStepMinutes: 15,
      defaultBufferBefore: 0,
      defaultBufferAfter: 10,
      cancellationWindowHrs: 12,
      allowGuestBooking: true,
      requirePhone: true,
      autoConfirm: true,
    },
  });

  // ── People ───────────────────────────────────────────────────────────────
  const owner = await prisma.user.create({
    data: {
      email: "owner@nobatyar.app",
      passwordHash,
      name: "دکتر نگار موسوی",
      phone: "09121234567",
      platformRole: "OWNER",
      locale: "fa",
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
  });

  const manager = await prisma.user.create({
    data: {
      email: "manager@nobatyar.app",
      passwordHash,
      name: "سارا ترابی",
      phone: "09351234567",
      platformRole: "STAFF",
      locale: "fa",
    },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: manager.id, role: "MANAGER" },
  });

  const customers = await Promise.all(
    [
      ["customer@nobatyar.app", "آرش کیانی", "09121110001"],
      ["maryam@example.com", "مریم رستمی", "09121110002"],
      ["ehsan@example.com", "احسان صادقی", "09121110003"],
      ["niloufar@example.com", "نیلوفر جعفری", "09121110004"],
      ["kaveh@example.com", "کاوه نظری", "09121110005"],
      ["shirin@example.com", "شیرین دولتی", "09121110006"],
      ["bahar@example.com", "بهار آزاد", "09121110007"],
      ["omid@example.com", "امید زمانی", "09121110008"],
    ].map(([email, name, phone]) =>
      prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          phone,
          platformRole: "CUSTOMER",
          locale: chance(0.3) ? "en" : "fa",
        },
      }),
    ),
  );

  // ── Catalogue ────────────────────────────────────────────────────────────
  const categories = await Promise.all(
    [
      { slug: "skin", name: "Skin & Face", nameFa: "پوست و صورت", icon: "Sparkles", sortOrder: 1 },
      { slug: "hair", name: "Hair", nameFa: "مو", icon: "Scissors", sortOrder: 2 },
      { slug: "consulting", name: "Consulting", nameFa: "مشاوره", icon: "MessagesSquare", sortOrder: 3 },
    ].map((c) => prisma.category.create({ data: { ...c, workspaceId: workspace.id } })),
  );
  const [skin, hair, consulting] = categories;

  const services = await Promise.all(
    [
      {
        slug: "skin-consultation",
        name: "Skin consultation",
        nameFa: "مشاوره پوست",
        shortDesc: "بررسی نوع پوست و طراحی برنامه مراقبتی",
        description:
          "در این جلسه نوع پوست، مشکلات فعلی و روتین پیشنهادی شما بررسی و یک برنامه مراقبتی مکتوب ارائه می‌شود.",
        durationMin: 30,
        priceAmount: 1_200_000,
        categoryId: skin.id,
        color: "#8b5cf6",
        sortOrder: 1,
      },
      {
        slug: "deep-cleansing",
        name: "Deep cleansing facial",
        nameFa: "پاکسازی عمیق پوست",
        shortDesc: "لایه‌برداری، ماسک و آبرسانی",
        description:
          "پاکسازی عمیق با دستگاه، لایه‌برداری شیمیایی ملایم، ماسک آبرسان و ماساژ پایانی.",
        durationMin: 60,
        bufferAfterMin: 10,
        priceAmount: 2_400_000,
        categoryId: skin.id,
        color: "#0ea5e9",
        sortOrder: 2,
      },
      {
        slug: "eyelash-lift",
        name: "Eyelash lift & tint",
        nameFa: "لیفت و رنگ مژه",
        shortDesc: "لیفت طبیعی مژه با فیکس",
        description: "لیفت مژه با مواد درجه یک، ماندگاری ۶ تا ۸ هفته.",
        durationMin: 75,
        bufferAfterMin: 15,
        priceAmount: 1_900_000,
        categoryId: skin.id,
        color: "#f59e0b",
        sortOrder: 3,
      },
      {
        slug: "haircut-styling",
        name: "Haircut & styling",
        nameFa: "اصلاح و استایل مو",
        shortDesc: "اصلاح مو با مشاوره مدل",
        description: "شست‌وشو، اصلاح و استایل مو متناسب با فرم صورت.",
        durationMin: 45,
        priceAmount: 900_000,
        categoryId: hair.id,
        color: "#10b981",
        sortOrder: 4,
      },
      {
        slug: "hair-colouring",
        name: "Hair colouring",
        nameFa: "رنگ مو",
        shortDesc: "رنگ‌آمیزی سراسری با مواد درجه یک",
        description: "رنگ‌آمیزی کامل با پوشش خاکستری و مراقبت پس از رنگ.",
        durationMin: 120,
        bufferAfterMin: 20,
        priceAmount: 3_500_000,
        categoryId: hair.id,
        color: "#ef4444",
        sortOrder: 5,
      },
      {
        slug: "nutrition-consult",
        name: "Nutrition consultation",
        nameFa: "مشاوره تغذیه",
        shortDesc: "برنامه غذایی شخصی‌سازی‌شده",
        description: "ارزیابی آزمایش‌ها و سبک زندگی، سپس ارائه برنامه غذایی ۴ هفته‌ای.",
        durationMin: 45,
        priceAmount: 1_500_000,
        categoryId: consulting.id,
        color: "#14b8a6",
        sortOrder: 6,
      },
    ].map((s) => prisma.service.create({ data: { ...s, workspaceId: workspace.id } })),
  );

  // ── Specialists + schedules ──────────────────────────────────────────────
  const staffDefs = [
    {
      slug: "mahsa",
      name: "مهسا پنجه‌طلا",
      title: "کارشناس مراقبت پوست",
      specialty: "پوست و لیفت مژه",
      bio: "۸ سال سابقه کار در کلینیک‌های پوست، تخصص در درمان جوش و لک.",
      services: [0, 1, 2],
      hours: [9, 10, 11, 13, 14, 15, 16, 17], // 09:00-12:00, 13:00-18:00
      user: manager,
    },
    {
      slug: "negar",
      name: "نگار احمدی",
      title: "آرایشگر و کارشناس مو",
      specialty: "رنگ و کوتاهی مو",
      bio: "متخصص کوتاهی و رنگ مو، دوره دیکالریست حرفه‌ای.",
      services: [3, 4],
      hours: [10, 11, 14, 15, 16, 17, 18, 19],
      user: null,
    },
    {
      slug: "sara",
      name: "سارا ترابی",
      title: "کارشناس تغذیه و رژیم",
      specialty: "تغذیه ورزشی و لاغری",
      bio: "کارشناس ارشد تغذیه، همراه برنامه‌های کاهش وزن پایدار.",
      services: [5, 0],
      hours: [9, 9, 10, 11, 12, 14, 15, 16],
      user: null,
    },
    {
      slug: "ali",
      name: "علی رضایی",
      title: "آرایشگر مردانه",
      specialty: "اصلاح و استایل",
      bio: "آرایشگر مردانه با سبک کلاسیک و مدرن.",
      services: [3],
      hours: [12, 13, 14, 15, 16, 17, 18, 19],
      user: null,
    },
  ];

  const staff: { id: string; hours: number[] }[] = [];
  for (const def of staffDefs) {
    const member = await prisma.staffMember.create({
      data: {
        workspaceId: workspace.id,
        userId: def.user?.id ?? null,
        name: def.name,
        slug: def.slug,
        title: def.title,
        specialty: def.specialty,
        bio: def.bio,
        sortOrder: staff.length,
      },
    });
    for (const index of def.services) {
      await prisma.staffService.create({
        data: { staffId: member.id, serviceId: services[index].id },
      });
    }
    // Saturday(6) → Thursday(4); Friday(5) is the weekly holiday
    for (const weekday of [6, 0, 1, 2, 3, 4]) {
      const hours = [...def.hours].sort((a, b) => a - b);
      // split the day into contiguous windows (max 4h each) → real breaks
      let cursor = 0;
      while (cursor < hours.length) {
        const start = hours[cursor];
        // `hours` holds clock hours; WorkingHour stores minutes of the day
        let end = (start + 1) * 60;
        while (
          cursor + 1 < hours.length &&
          hours[cursor + 1] === hours[cursor] + 1 &&
          end < (start + 4) * 60
        ) {
          cursor += 1;
          end = (hours[cursor] + 1) * 60;
        }
        await prisma.workingHour.create({
          data: {
            staffId: member.id,
            weekday,
            startMinute: start * 60,
            endMinute: end,
          },
        });
        cursor += 1;
      }
    }
    staff.push({ id: member.id, hours: def.hours });
  }

  // ── Time off + one public holiday ────────────────────────────────────────
  const today = todayCivil();
  const inThreeDays = addDays(today, 3);
  const inNineDays = addDays(today, 9);  await prisma.timeOff.create({
    data: {
      staffId: staff[0].id,
      startsAt: at(inThreeDays, 9 * 60),
      endsAt: at(inThreeDays, 13 * 60),
      note: "دوره آموزشی",
    },
  });
  await prisma.timeOff.create({
    data: {
      staffId: staff[1].id,
      startsAt: at(inNineDays, 10 * 60),
      endsAt: at(inNineDays, 19 * 60),
      note: "مرخصی",
    },
  });
  await prisma.holiday.create({
    data: {
      workspaceId: workspace.id,
      date: at(addDays(today, 21), 0),
      note: "تعطیلی رسمی",
    },
  });

  // ── Locations (multi-branch) ─────────────────────────────────────────────
  const mainBranch = await prisma.location.create({
    data: {
      workspaceId: workspace.id,
      slug: "vanak",
      name: "Aria — Vanak branch",
      nameFa: "آریا — شعبه ونک",
      address: "تهران، خیابان ولیعصر، بالاتر از میدان ونک، پلاک ۱۲۰",
      phone: "۰۲۱-۸۸۴۴۲۲۱۱",
      sortOrder: 1,
    },
  });
  const northBranch = await prisma.location.create({
    data: {
      workspaceId: workspace.id,
      slug: "saadat-abad",
      name: "Aria — Saadat Abad branch",
      nameFa: "آریا — شعبه سعادت‌آباد",
      address: "تهران، بلوار سعادت‌آباد، نبش مروارید، پلاک ۴۵",
      phone: "۰۲۱-۲۲۳۳۴۴۵۵",
      sortOrder: 2,
    },
  });

  await prisma.locationService.createMany({
    data: services.map((service) => ({
      locationId: mainBranch.id,
      serviceId: service.id,
    })),
  });
  await prisma.locationService.createMany({
    data: services.slice(0, 4).map((service) => ({
      locationId: northBranch.id,
      serviceId: service.id,
    })),
  });
  await prisma.staffLocation.createMany({
    data: staff.map((member) => ({ staffId: member.id, locationId: mainBranch.id })),
  });
  await prisma.staffLocation.createMany({
    data: [
      { staffId: staff[0].id, locationId: northBranch.id },
      { staffId: staff[2].id, locationId: northBranch.id },
    ],
  });

  // ── Packages (prepaid session bundles) ───────────────────────────────────
  const skinPackage = await prisma.package.create({
    data: {
      workspaceId: workspace.id,
      slug: "skin-starter",
      name: "Skin starter — 5 sessions",
      nameFa: "شروع پوست — ۵ جلسه",
      description: "پنج جلسه مشاوره و پاکسازی پوست با ۱۵٪ تخفیف نسبت به تک‌جلسه‌ای.",
      priceAmount: 4_800_000,
      validDays: 90,
      sortOrder: 1,
      services: {
        create: [
          { serviceId: services[0].id, quantity: 2 },
          { serviceId: services[1].id, quantity: 3 },
        ],
      },
    },
    include: { services: true },
  });

  const carePackage = await prisma.package.create({
    data: {
      workspaceId: workspace.id,
      slug: "full-care",
      name: "Full care — 8 sessions",
      nameFa: "مراقبت کامل — ۸ جلسه",
      description: "ترکیبی از خدمات پوست و مو برای یک دوره کامل مراقبت.",
      priceAmount: 7_200_000,
      validDays: 120,
      sortOrder: 2,
      services: {
        create: [
          { serviceId: services[0].id, quantity: 2 },
          { serviceId: services[2].id, quantity: 2 },
          { serviceId: services[3].id, quantity: 4 },
        ],
      },
    },
    include: { services: true },
  });

  const expiresAt = new Date(at(addDays(today, 60), 0).getTime());
  const skinSessions = skinPackage.services.reduce((sum, line) => sum + line.quantity, 0);

  // The demo login owns a package too, so the "spend a session" path is
  // reachable straight after signing in.
  await prisma.packagePurchase.create({
    data: {
      packageId: skinPackage.id,
      workspaceId: workspace.id,
      customerUserId: customers[0].id,
      customerName: customers[0].name,
      customerEmail: customers[0].email,
      customerPhone: customers[0].phone ?? "09121234567",
      totalSessions: skinSessions,
      usedSessions: 0,
      amountPaid: 4_800_000,
      purchasedAt: new Date(at(addDays(today, -10), 600).getTime()),
      expiresAt,
      status: "ACTIVE",
    },
  });

  const maryamPurchase = await prisma.packagePurchase.create({
    data: {
      packageId: skinPackage.id,
      workspaceId: workspace.id,
      customerUserId: customers[1].id,
      customerName: customers[1].name,
      customerEmail: customers[1].email,
      customerPhone: customers[1].phone ?? "09121234567",
      totalSessions: skinSessions,
      usedSessions: 1,
      amountPaid: 4_800_000,
      purchasedAt: new Date(at(addDays(today, -20), 600).getTime()),
      expiresAt,
      status: "ACTIVE",
    },
  });
  const maryamPurchaseId = maryamPurchase.id;
  await prisma.packagePurchase.create({
    data: {
      packageId: carePackage.id,
      workspaceId: workspace.id,
      customerUserId: customers[4].id,
      customerName: customers[4].name,
      customerEmail: customers[4].email,
      customerPhone: customers[4].phone ?? "09121234567",
      totalSessions: carePackage.services.reduce((sum, line) => sum + line.quantity, 0),
      usedSessions: 3,
      amountPaid: 7_200_000,
      purchasedAt: new Date(at(addDays(today, -45), 600).getTime()),
      expiresAt,
      status: "ACTIVE",
    },
  });

  // ── Booking history (past 21 days + next 12 days) ────────────────────────
  const notes = [
    "ممنون از وقتی که گذاشتید 🙏",
    "لطفاً قبل از مراجعه شماره تماس جدیدم را ثبت کنید.",
    "درخواست مشاوره درباره حساسیت پوست دارم.",
    "اگر ممکن است بعدازظهر بیایم.",
    null,
    null,
  ];

  let created = 0;
  for (let dayOffset = -21; dayOffset <= 12; dayOffset += 1) {
    const date = addDays(today, dayOffset);
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    if (weekday === 5) continue; // Friday closed

    for (const member of staff) {
      const perDay = weekday === 6 ? 3 : 2; // Saturdays are busier
      for (let i = 0; i < perDay; i += 1) {
        if (!chance(0.82)) continue;

        const link = await prisma.staffService.findFirst({
          where: { staffId: member.id },
          include: { service: true },
        });
        if (!link) continue;
        const service = link.service;

        const base = member.hours[(i * 2 + Math.floor(rand() * 2)) % member.hours.length];
        const startMinute = base * 60 + (chance(0.4) ? 30 : 0);
        const startsAt = at(date, startMinute);
        if (startsAt.getTime() < Date.now() - 2 * MIN) continue;
        const endsAt = new Date(startsAt.getTime() + service.durationMin * MIN);

        // never overlap an existing row of the same specialist
        const clash = await prisma.appointment.findFirst({
          where: {
            staffId: member.id,
            status: { notIn: ["CANCELLED"] },
            startsAt: { lt: new Date(endsAt.getTime() + (service.bufferAfterMin || 0) * MIN) },
            endsAt: { gt: new Date(startsAt.getTime() - (service.bufferBeforeMin || 0) * MIN) },
          },
        });
        if (clash) continue;

        const customer = pickOne(customers);
        const status =
          dayOffset < 0
            ? chance(0.86)
              ? "COMPLETED"
              : chance(0.5)
                ? "NO_SHOW"
                : "CANCELLED"
            : dayOffset <= 2
              ? chance(0.7)
                ? "CONFIRMED"
                : "PENDING"
              : chance(0.6)
                ? "CONFIRMED"
                : "PENDING";

        // Maryam's bundle paid for one of her past visits, so the dashboard
        // counters and the per-service quota agree with the history
        const packagePurchaseId =
          customer.id === customers[1].id && dayOffset < 0 && created % 7 === 0
            ? maryamPurchaseId
            : null;

        await prisma.appointment.create({
          data: {
            workspaceId: workspace.id,
            serviceId: service.id,
            staffId: member.id,
            customerUserId: customer.id,
            customerName: customer.name,
            customerEmail: customer.email,
            customerPhone: customer.phone ?? "09120000000",
            startsAt,
            endsAt,
            status,
            source: chance(0.25) ? "ADMIN" : "WEB",
            trackingCode: code(),
            priceAmount: service.priceAmount,
            notes: pickOne(notes),
            packagePurchaseId,
            cancelledAt: status === "CANCELLED" ? startsAt : null,
            cancelReason: status === "CANCELLED" ? pickOne(["انصراف کاربر", "درخواست تغییر برنامه"]) : null,
          },
        });
        created += 1;
      }
    }
  }

  // ── Waitlist + support tickets ───────────────────────────────────────────
  await prisma.waitlistEntry.createMany({
    data: [
      {
        workspaceId: workspace.id,
        serviceId: services[4].id,
        staffId: staff[1].id,
        customerUserId: customers[5].id,
        customerName: "شیرین دولتی",
        customerPhone: "09121110006",
        preferredDate: at(addDays(today, 4), 0),
        preferredStartMinute: 16 * 60,
        status: "PENDING",
      },
      {
        workspaceId: workspace.id,
        serviceId: services[1].id,
        staffId: null,
        customerName: "مهمان",
        customerPhone: "09121119999",
        preferredDate: at(addDays(today, 2), 0),
        status: "PENDING",
      },
    ],
  });

  await prisma.supportTicket.createMany({
    data: [
      {
        workspaceId: workspace.id,
        userId: customers[1].id,
        message: "آیا امکان رزرو برای دو نفر در یک روز وجود دارد؟",
        status: "OPEN",
      },
      {
        workspaceId: workspace.id,
        userId: customers[4].id,
        message: "لطفاً بعدازظهر‌ها بازه خالی بیشتری اضافه کنید.",
        status: "ANSWERED",
        adminReply: "حتماً؛ از هفته آینده بازه‌های ۱۷ تا ۱۹ اضافه شد.",
      },
    ],
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      action: "SEED",
      entity: "workspace",
      entityId: workspace.id,
      actorEmail: owner.email,
      meta: JSON.stringify({ appointments: created }),
    },
  });

  const totals = {
    workspace: workspace.slug,
    categories: categories.length,
    services: services.length,
    staff: staff.length,
    locations: 2,
    packages: 2,
    appointments: created,
    customers: customers.length,
  };
  console.log("✔ Demo data ready:", totals);
  console.log(`  owner     : owner@nobatyar.app / ${DEFAULT_PASSWORD}`);
  console.log(`  customer  : customer@nobatyar.app / ${DEFAULT_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
