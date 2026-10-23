import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createFootprintService } from "./server/service";

export default function contribute(server: PluginServerContext) {
  return createFootprintService(server);
}
