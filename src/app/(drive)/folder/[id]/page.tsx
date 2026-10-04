import { DriveView } from "@/components/drive/DriveView";

export default async function FolderPage({ params }: PageProps<"/folder/[id]">) {
  const { id } = await params;
  return <DriveView view="folder" folderId={id} />;
}
