import { IncidentDetailClient } from "@/components/IncidentDetailClient";

export default function IncidentDetailPage({ params }: { params: { id: string } }) {
  return <IncidentDetailClient id={params.id} />;
}
