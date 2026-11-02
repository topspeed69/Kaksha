import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";
import { inter, jetBrainsMono, spaceGrotesk } from "./fonts";
import { AppFooter, AppHeader, MobileTabBar } from "@/components/ui/AppHeader";
import { QueryProvider } from "@/lib/query";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Lumen · AI classroom",
  description:
    "Lumen turns a topic or a paper into a narrated, animated lecture with a whiteboard and graded quizzes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0e" },
  ],
};

/**
 * Applied before the first paint so a dark-mode visitor never sees a white
 * flash. It mirrors the logic in ThemeProvider, but runs synchronously in the
 * document head instead of after hydration.
 */
const themeBootScript = `(function(){try{
var s=localStorage.getItem("lumen.appearance");
var t=(s&&JSON.parse(s).theme)||"system";
var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var r=document.documentElement;
r.classList.toggle("dark",dark);
r.style.colorScheme=dark?"dark":"light";
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>
              <a
                href="#main"
                className="type-label sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:text-bg"
              >
                Skip to content
              </a>
              <AppHeader />
              <main id="main" className="shell py-4 pb-24 md:py-8 md:pb-8">
                {children}
              </main>
              <AppFooter />
              <MobileTabBar />
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
