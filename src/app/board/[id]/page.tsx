import { BoardPage } from "@/components/board/BoardPage";

export default async function Page({ params }: PageProps<"/board/[id]">) {
  const { id } = await params;
  return <BoardPage id={id} />;
}
