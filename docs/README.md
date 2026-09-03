# Flowline docs

Three documents, each answering a different question. The application itself is the primary
document; these exist for the parts source code does not state.

| doc | what it answers |
| --- | --- |
| [Game design](./game-design.md) | what the player learns, and which decision stays theirs |
| [Architecture](./architecture.md) | module boundaries, state flow, and where the tool layer sits |
| [Challenge adaptation](./challenge-adaptation.md) | which systems problem this is a game about, and what was taken from it |

The agent boundary — what a caller can reach, what is refused, and what this package
deliberately does not address — is in [`SECURITY.md`](../SECURITY.md) rather than here, because
it is a property of the code and not a design note.

`images/` holds the figures the [README](../README.md) uses. They are captures of the built
application at 1440 × 900 and 390 × 844, taken from a local production preview.

## What is not here

The working record behind this game — the measurement runs and the scripts that produced them,
the status ledgers, the decision log, the release gates, the art-direction references it was
built against — is kept privately and is not part of this repository. It is a record of how the
game was made, and it would answer questions nobody reading the game needs answered. Where a
claim in the README depends on a measurement, the README says what was measured and what the
measurement cannot support.
