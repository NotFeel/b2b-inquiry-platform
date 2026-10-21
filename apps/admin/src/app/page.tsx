import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE } from '../lib/i18n';

export default function IndexPage() {
  redirect(`/${DEFAULT_LOCALE}/dashboard`);
}
