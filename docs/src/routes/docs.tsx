import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "../source";

export const Route = createFileRoute("/docs")({
  component: DocsLayoutRoute,
});

function DocsLayoutRoute() {
  return (
    <DocsLayout tree={source.pageTree} nav={{ title: "forrealtime" }}>
      <Outlet />
    </DocsLayout>
  );
}
