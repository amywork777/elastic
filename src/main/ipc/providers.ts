/**
 * `providers.*` handlers, over the one `ProviderStore` (`../providers`).
 */
import type { IpcHandlers } from "../../shared/ipc";
import type { providersContract } from "../../shared/ipc/providers";
import { providerStore } from "../providers";
import { testProvider } from "../providers/test";
import { IpcError } from "./register";

export const providersHandlers = {
  providers: {
    list: () => providerStore().list(),
    save: (input) => providerStore().save(input),
    remove: ({ id }) => providerStore().remove(id),
    test: async ({ id }) => {
      const store = providerStore();
      const provider = store.get(id);
      if (!provider) throw new IpcError("That provider was removed.");
      return testProvider(provider, store.key(id));
    },
  },
} satisfies IpcHandlers<typeof providersContract>;
