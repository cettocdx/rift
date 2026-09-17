import { UpgradePageContent } from "./UpgradePageContent";

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string | string[] }>;
}) {
  const query = await searchParams;
  const feature = Array.isArray(query.feature)
    ? query.feature[0]
    : query.feature;

  return <UpgradePageContent feature={feature} />;
}
