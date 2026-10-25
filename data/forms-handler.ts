/**
 * -------------------------------------------------------------------------
 * @file   forms-handler.ts
 * @brief  Receives Form Submissions posted by linked Sites.
 *
 * @description
 *  `POST /api/forms` carries the Organization's Forms key as a bearer token
 *  and a JSON body with the Site's hostname, the Site-minted submission id,
 *  the page, and the form fields. A new submission answers 201, a repeated
 *  submission id answers 200 with the existing row, and refusals answer
 *  401 for an unknown key, 404 for a hostname that is not one of the
 *  Organization's Sites, 409 for a Site with no open Site Link, and 400
 *  for a body without a name or any contact.
 *
 * @remarks
 *  The endpoint carries no session; the Forms key authenticates the Site.
 *  The response never includes the key or other Sites' data, only the
 *  stored submission's id and hold state the Site may log.
 *
 * @see
 *  data/form-submissions.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { FormSubmissionsError, ingestFormSubmission } from "@/data/form-submissions";
import type { TransactionalEmail } from "@/data/transactional-email";

export interface FormsHandlerOptions {
  database: Database;
  email: TransactionalEmail;
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function createFormsHandler(options: FormsHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return response({ error: "not_found" }, 404);
    const authorization = request.headers.get("authorization") ?? "";
    const key = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return response({ error: "invalid_input" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "invalid_input" }, 400);
    const input = body as Record<string, unknown>;
    try {
      const result = await ingestFormSubmission(options.database, options.email, { key, site: input.site, submissionId: input.submissionId, page: input.page, fields: input.fields });
      const { submission } = result;
      return response({ submission: { id: submission.id, held: submission.held, forward: submission.forward } }, result.created ? 201 : 200);
    } catch (error) {
      if (error instanceof FormSubmissionsError) {
        const status = error.code === "unauthorized_key" ? 401 : error.code === "site_unknown" ? 404 : error.code === "site_not_linked" ? 409 : 400;
        return response({ error: error.code === "unauthorized_key" ? "unauthorized" : error.code }, status);
      }
      throw error;
    }
  };
}
