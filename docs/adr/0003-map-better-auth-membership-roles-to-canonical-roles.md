# Map Better Auth membership roles to canonical roles

Tracer maps Better Auth's default `owner` membership role to the canonical Operator role and `member` to the canonical Client Viewer role. Domain and product interfaces never expose Better Auth role terms. Tracer does not enable the Better Auth admin plugin.

This is a deliberate tradeoff because the default role mapping is difficult to reverse and can be surprising at the integration boundary. The mapping preserves Better Auth's plugin defaults and avoids custom authorization seams while keeping Tracer's canonical language at every product boundary.
