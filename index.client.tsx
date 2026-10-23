import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FootprintScreen } from "./client/screen";
import { FootprintSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext): PluginCleanup {
  const cleanups = [
    client.addScreen({ id: "footprint", title: "Eco footprint", Component: FootprintScreen }),
    client.addSidebarFooterItem({
      id: "footprint-today",
      title: "Eco footprint",
      Component: FootprintSidebarItem,
    }),
    client.addCommandCenterItem({
      id: "open-footprint",
      title: "Open eco footprint",
      icon: "Leaf",
      keywords: ["eco", "footprint", "energy", "co2", "carbon", "emissions"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: "footprint" });
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
