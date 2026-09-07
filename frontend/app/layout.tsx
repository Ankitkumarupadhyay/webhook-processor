import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Reliable Webhook Processor - Dashboard',
  description: 'Operations dashboard for webhook monitoring, retries, and attempt history',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
