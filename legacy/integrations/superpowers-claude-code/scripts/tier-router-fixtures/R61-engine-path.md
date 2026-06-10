CURRENT-ROUND: R61
NEXT-ROLE: ARCHITECT
STATUS: READY

## § R61 Round-scope directive

Introduce the streaming tokenizer in engine/lexer.ts. This is A2 (new
architectural pattern): no incremental lexing precedent exists in the
codebase. Design the buffer-boundary contract before implementation.
