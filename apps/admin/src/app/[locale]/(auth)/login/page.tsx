import { LoginForm } from '../../../../components/login-form';
import { sanitizeReturnTo } from '../../../../lib/layout-state';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}

// The first sign-in always requires a password change; the API enforces that and
// every screen surfaces the resulting error until it is resolved (docs/01 §3.1).
export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const resolved = locale === 'en-US' ? 'en-US' : 'zh-CN';
  const query = await searchParams;
  const raw = Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo;
  // Only an internal path is accepted; anything else falls back to the dashboard.
  const returnTo = sanitizeReturnTo(raw, `/${resolved}/dashboard`);
  return <LoginForm locale={resolved} returnTo={returnTo} />;
}
