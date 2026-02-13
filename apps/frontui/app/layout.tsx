import { ConversationSidebar } from "@/components/chat-workspace/conversation-sidebar";
import { Providers } from "@/components/providers";
import { Toaster } from "@workspace/ui/components/sonner";
import "@workspace/ui/globals.css";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FrontClaw/FrontUI",
  description: "FrontClaw/FrontUI conversational UI",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="frontui-typography antialiased">
        <Providers>
          <div className="app-fade-in">
            <div className="grain-overlay" />
            <div className="flex h-screen">
              <ConversationSidebar />
              <main className="flex-1 relative z-10 overflow-hidden">{children}</main>
            </div>
          </div>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
