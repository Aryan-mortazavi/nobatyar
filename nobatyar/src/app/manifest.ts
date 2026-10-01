import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NobatYar — نوبت‌یار",
    short_name: "NobatYar",
    description:
      "سامانه هوشمند رزرو نوبت آنلاین: تقویم شمسی، بازه‌های آزاد واقعی، لینک و کد QR، یادآوری خودکار و پنل مدیریت.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    orientation: "portrait",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
