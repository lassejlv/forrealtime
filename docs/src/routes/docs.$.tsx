import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from "fumadocs-ui/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { source } from "../source";

export const Route = createFileRoute("/docs/$")({
  component: DocsSlugPage,
});

function DocsSlugPage() {
  const { _splat } = Route.useParams();
  const slug = _splat ? _splat.split("/").filter(Boolean) : [];
  const page = source.getPage(slug);
  if (!page) throw notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}
