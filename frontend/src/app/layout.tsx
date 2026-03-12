import "katex/dist/katex.min.css";
import "prism-themes/themes/prism-vsc-dark-plus.css";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
