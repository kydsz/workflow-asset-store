import type { ReactNode } from 'react';
import Script from 'next/script';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { AppNav } from '@/components/AppNav';
import { GlobalDropZone } from '@/components/GlobalDropZone';
import { ThemeProvider } from '@/components/theme-provider';
import { LocaleProvider } from '@/components/locale-provider';
import { Toaster } from '@/components/ui/sonner';
import { getServerT } from '@/lib/locale-server';
import { BCP47 } from '@/lib/locale';
import { getWebApi } from '@/src/webApi';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getServerT();
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const t = await getServerT();
  const api = getWebApi();
  const recipes = api.listRecipes().map((r) => ({ id: r.id, name: r.name }));
  const incompleteCount = api.listIncomplete().length;
  return (
    <html lang={BCP47[t.locale]} suppressHydrationWarning className={cn('font-sans', geist.variable)}>
      <head>
        {/* next/script 的 beforeInteractive 才会被注进首屏 HTML；JSX 里裸 <script> 在客户端渲染时被 React 警告且不执行 */}
        <Script
          id="was-theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=document.documentElement;var t=localStorage.getItem('was-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='system'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}e.classList.add(t);e.style.colorScheme=t;var c=localStorage.getItem('was-gallery-columns');if(c>=2&&c<=6)e.style.setProperty('--was-gallery-columns',c);var h=localStorage.getItem('was-gallery-thumb-h');if(h!==null&&h!==''){var n=+h;e.style.setProperty('--was-gallery-thumb-h',(n>0?n:(n===0?100000:384))+'px')}}catch(x){}})()`,
          }}
        />
      </head>
      <body>
        <LocaleProvider initialLocale={t.locale}>
          <ThemeProvider>
            <div className="flex min-h-screen">
              <AppNav recipes={recipes} incompleteCount={incompleteCount} />
              <main className="min-w-0 flex-1 px-6 py-6 lg:px-10">{children}</main>
            </div>
            <GlobalDropZone />
            <Toaster position="top-right" />
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
