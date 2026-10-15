/**
 * -------------------------------------------------------------------------
 * @file   environment-bindings.test.ts
 * @brief  Verifies deployment database binding isolation.
 *
 * @description
 *  Reads the committed Wrangler configuration and proves that Preview and
 *  Staging cannot resolve Tracer's Production Hyperdrive configuration.
 *
 * @remarks
 *  Hyperdrive identifiers are inventory metadata and contain no credentials.
 *
 * @see
 *  docs/adr/0002-isolate-production-data-from-shared-non-production.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";

import { parse } from "jsonc-parser";
import { expect, it } from "vitest";

interface HyperdriveBinding {
  binding: string;
  id: string;
  localConnectionString?: string;
}

interface EnvironmentBindings {
  hyperdrive?: HyperdriveBinding[];
  send_email?: SendEmailBinding[];
  services?: unknown[];
}

interface SendEmailBinding {
  name: string;
  remote?: boolean;
}

interface WranglerConfiguration extends EnvironmentBindings {
  send_email?: SendEmailBinding[];
  previews?: EnvironmentBindings;
  env?: {
    staging?: EnvironmentBindings;
  };
}

const configuration = parse(
  readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
) as WranglerConfiguration;

it("keeps Preview and Staging Hyperdrive bindings isolated from Production", () => {
  const production = configuration.hyperdrive?.[0];
  const preview = configuration.previews?.hyperdrive?.[0];
  const staging = configuration.env?.staging?.hyperdrive?.[0];

  expect(production).toEqual({
    binding: "HYPERDRIVE",
    id: "c7bee152d6814904b4244700482815e2",
    localConnectionString: "postgresql://postgres:postgres@127.0.0.1:5432/tracer",
  });
  expect(preview).toEqual({
    binding: "HYPERDRIVE",
    id: "36fd65b2679c4b739d224f1056b29070",
  });
  expect(staging).toEqual({
    binding: "HYPERDRIVE",
    id: "19a5d9e69d2a4a82b33c5d3f8cf2480f",
    localConnectionString: "postgresql://postgres:postgres@127.0.0.1:5432/tracer",
  });
  expect(preview?.id).not.toBe(production?.id);
  expect(staging?.id).not.toBe(production?.id);
  expect(configuration.previews?.services).toBeUndefined();
  expect(configuration.env?.staging?.services).toBeUndefined();
  expect(configuration.send_email).toEqual([{ name: "EMAIL", remote: true }]);
  expect(configuration.previews?.send_email).toEqual([{ name: "EMAIL", remote: true }]);
  expect(configuration.env?.staging?.send_email).toEqual([{ name: "EMAIL", remote: true }]);
});
