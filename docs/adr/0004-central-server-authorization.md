# Enforce authorization at the server boundary

Tracer resolves the acting identity once per request through `resolveActor`, which combines the Better Auth session with the user's Organization membership, and gates Operator-only pages and the `/api/users` handler through `requireActiveOperator`. An Active Operator is a user whose User State is Active and whose membership role maps to Operator. Hidden navigation is a convenience for the Sidebar and never substitutes for this check; Operator-only pages respond with Not Found to any other identity and the API responds with 401 or 403.

Client Viewer provisioning and role changes are deliberately unavailable until M8, when an Active Workspace exists and the required Access Grant can be created in the same transaction.
