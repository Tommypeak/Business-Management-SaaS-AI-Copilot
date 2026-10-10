import { AnalyticsScreen, type SearchParams } from '../../../../../../components/analytics/screen';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return (
    <AnalyticsScreen org={(await params).organizationId} mode="sales" search={await searchParams} />
  );
}
