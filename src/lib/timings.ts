type Stage = "reformulacion" | "embeddings" | "lexica" | "vectorial" | "hidratacion";

/** Suma tiempo de trabajo por etapa; con consultas paralelas no es tiempo total de pared. */
export function createTimings() {
  const enabled = process.env.RAIZIA_TIEMPOS === "1";
  const durations: Record<Stage, number> = { reformulacion: 0, embeddings: 0, lexica: 0, vectorial: 0, hidratacion: 0 };
  return {
    async measure<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
      if (!enabled) return operation();
      const start = performance.now();
      try { return await operation(); }
      finally { durations[stage] += performance.now() - start; }
    },
    report() {
      if (enabled) console.log(JSON.stringify(Object.fromEntries(
        Object.entries(durations).map(([stage, ms]) => [`${stage}_ms`, Math.round(ms * 100) / 100]),
      )));
    },
  };
}

export type Timings = ReturnType<typeof createTimings>;
