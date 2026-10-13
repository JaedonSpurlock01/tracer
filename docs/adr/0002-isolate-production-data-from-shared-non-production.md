# Isolate Production data from shared non-production

Tracer uses separate Neon projects for Staging and Production. Preview intentionally shares the Staging database to limit first-release infrastructure overhead, but Preview and Staging use separate Hyperdrive configurations so bindings and credentials can be inventoried and rotated independently. Production uses its own Hyperdrive configuration and neither non-production environment may resolve Production data or bindings.

Runtime database roles receive only the privileges required by public repository behavior. Schema migrations use dedicated direct connections outside the Worker runtime. Schema failures are corrected with forward migrations, with Neon point-in-time or branch restore reserved for failed promotion recovery.
