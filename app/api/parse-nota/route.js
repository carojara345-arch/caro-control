export async function POST(request) {
  try {
    const { texto, clientes } = await request.json();
    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return Response.json({ error: "Falta el texto de la nota." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel." },
        { status: 500 }
      );
    }

    const nombresClientes = (clientes || []).map((c) => c.nombre).filter(Boolean).join(", ") || "(sin clientes registrados aún)";
    const hoy = new Date().toISOString().slice(0, 10);

    const systemPrompt = `Eres el motor de lenguaje natural de Caro Control, el sistema de una contadora independiente en Colombia. Tu única tarea es leer una nota escrita a mano y convertirla en una lista de elementos estructurados en JSON.

Reglas estrictas, sin excepción:
- Responde ÚNICAMENTE con un array JSON válido. Nada de texto antes o después, nada de markdown, nada de \`\`\`.
- NUNCA inventes información que no esté explícita o claramente implícita en la nota (fechas, valores, nombres). Si falta un dato esencial para que el elemento sea útil, crea un elemento tipo "pendiente_aclarar" con una pregunta concreta en vez de adivinar.
- Los clientes ya registrados en el sistema son: ${nombresClientes}. Si la nota menciona un nombre que coincide (aunque sea parcialmente, ej. solo el nombre de pila) con uno de estos, usa exactamente el nombre completo registrado en "clienteNombre". Si menciona un nombre que NO está en esa lista, NO lo trates como cliente existente: crea un elemento "pendiente_aclarar" preguntando si se debe registrar ese cliente nuevo.
- La fecha de hoy es ${hoy}. Convierte referencias relativas de fecha ("mañana", "el jueves", "en 8 días", "la próxima semana") a fechas ISO (YYYY-MM-DD) basándote en hoy. Si la nota no da ninguna pista de fecha para algo que la necesita, deja el campo de fecha en null en vez de inventarla.
- Cada elemento del array debe tener EXACTAMENTE esta forma:
  { "tipo": "tarea" | "cobro" | "agenda" | "pendiente_aclarar", "clienteNombre": string | null, "campos": {}, "pregunta": string | null }
- Para "tarea", campos admite: titulo (string, obligatorio), descripcion (string u omitir), prioridad ("Crítica"|"Alta"|"Media"|"Baja", por defecto "Media" si no hay pistas), fechaLimite (YYYY-MM-DD o null).
- Para "cobro", campos admite: concepto (string, obligatorio), valor (número plano, sin puntos ni símbolos ni texto), fechaEsperada (YYYY-MM-DD o null).
- Para "agenda", campos admite: titulo (string, obligatorio), tipo (string, ej. "Reunión", "Cita", "Llamada"), fecha (YYYY-MM-DD, obligatorio — si no hay fecha clara, esto debe ser un pendiente_aclarar en vez de un elemento agenda), hora (HH:MM 24h o null).
- Para "pendiente_aclarar", deja "campos" como un objeto vacío {} y usa "pregunta" para explicar exactamente qué falta o qué se debe confirmar.
- Si la nota no contiene absolutamente nada accionable, responde con un array vacío [].
- No agregues comentarios, explicaciones ni ningún texto fuera del array JSON.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: texto }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return Response.json(
        { error: data?.error?.message || `La API de Claude devolvió un error (${res.status}).` },
        { status: 502 }
      );
    }

    const textBlock = data.content?.find((b) => b.type === "text")?.text || "[]";
    let items;
    try {
      const cleaned = textBlock.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
      items = JSON.parse(cleaned);
    } catch {
      return Response.json({ error: "La respuesta no vino en el formato esperado. Intenta de nuevo." }, { status: 502 });
    }
    if (!Array.isArray(items)) items = [];

    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e?.message || "Error inesperado procesando la nota." }, { status: 500 });
  }
}
