import { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedChatView } from "./SharedChatView";

type Props = {
  params: Promise<{ shareId: string }>;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;

  return {
    title: "Shared Chat | RIFT",
    description: "View a shared conversation from RIFT",
    robots: "noindex, nofollow", // Don't index shared chats
  };
}

export default async function SharedChatPage({ params }: Props) {
  const { shareId } = await params;

  if (!UUID_REGEX.test(shareId)) {
    notFound();
  }

  return <SharedChatView shareId={shareId} />;
}
