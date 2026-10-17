import type { Metadata } from 'next';
import '@fontsource-variable/vazirmatn';
import './globals.css';
export const metadata: Metadata = { title: 'پژوهش | گردآوری آثار پژوهشگران', description: 'تجمیع رایگان اطلاعات عمومی آثار پژوهشگران با شناسه‌های ORCID، Scopus، Web of Science و Google Scholar، ورود اکسل و خروجی اکسل.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
