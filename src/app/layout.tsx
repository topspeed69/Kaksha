import type { Metadata } from "next";
import type { ReactNode } from "react";
import "katex/dist/katex.min.css";
import "./globals.css";
import { inter, jetBrainsMono, spaceGrotesk } from "./fonts";
import { AppFooter, AppHeader } from "@/components/ui/AppHeader";
import { QueryProvider } from "@/lib/query";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Lumen · AI classroom",
  description:
    "Lumen turns a topic or a paper into a narrated, animated lecture with a whiteboard and graded quizzes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetBrainsMono.variable}`}
    >
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
              <main id="main" className="shell py-8">
                {children}
              </main>
              <AppFooter />
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
