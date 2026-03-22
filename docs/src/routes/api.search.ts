import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "../source";

const searchApi = createFromSource(source);

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: () => searchApi.GET(getRequest()),
    },
  },
});
