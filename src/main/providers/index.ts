/**
 * The one `ProviderStore` (Settings › Models & keys), sealed by the OS keychain
 * through Electron's `safeStorage`, plain only where the platform has none.
 */
import path from "node:path";

import { app, safeStorage } from "electron";

import { PLAIN_CODEC, type Codec } from "../plugins/oauth";
import { ProviderStore } from "./store";

function keychainCodec(): Codec {
  if (!safeStorage.isEncryptionAvailable()) return PLAIN_CODEC;
  return {
    seal: (text) => `v1:${safeStorage.encryptString(text).toString("base64")}`,
    open: (sealed) => (sealed.startsWith("v1:") ? safeStorage.decryptString(Buffer.from(sealed.slice(3), "base64")) : sealed),
  };
}

let store: ProviderStore | null = null;

export function providerStore(): ProviderStore {
  store ??= new ProviderStore(path.join(app.getPath("userData"), "providers.json"), keychainCodec());
  return store;
}
