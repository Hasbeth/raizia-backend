export let accesos = 0;

function prohibido() {
  accesos += 1;
  throw new Error("Una función pura intentó acceder a la base de datos.");
}

export { prohibido as query, prohibido as all, prohibido as get, prohibido as run, prohibido as tx, prohibido as db };
