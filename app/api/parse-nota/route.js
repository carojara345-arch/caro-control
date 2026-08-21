export async function POST(request) {
  try {
    const { texto, contexto } = await request.json();
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

    const clientes = contexto?.clientes || [];
    const tareasAbiertas = contexto?.tareasAbiertas || [];
    const documentosPendientes = contexto?.documentosPendientes || [];
    const hoy = new Date().toISOString().slice(0, 10);
    const diaSemana = new Date().toLocaleDateString("es-CO", { weekday: "long" });

    const listaClientes = clientes.length
      ? clientes.map((c) => `- ${c.nombre} (id: ${c.id})`).join("\n")
      : "(sin clientes registrados aún)";
    const listaTareas = tareasAbiertas.length
      ? tareasAbiertas.map((t) => `- "${t.titulo}" — cliente: ${t.clienteNombre || "ninguno"} (id: ${t.id})`).join("\n")
      : "(sin tareas abiertas)";
    const listaDocs = documentosPendientes.length
      ? documentosPendientes.map((d) => `- "${d.nombre}" — cliente: ${d.clienteNombre || "ninguno"} — estado: ${d.estado} (id: ${d.id})`).join("\n")
      : "(sin documentos pendientes registrados)";

    const systemPrompt = `Eres el motor de lenguaje natural de Caro Control, el sistema de una contadora independiente en Colombia. Lees una nota escrita de forma natural y decides qué acciones concretas corresponden, para que el sistema las ejecute directamente contra la base de datos. No es un borrador para que ella confirme manualmente: tus decisiones se ejecutan tal cual, así que solo actúa cuando la intención esté razonablemente clara.

Hoy es ${diaSemana}, ${hoy} (formato YYYY-MM-DD).

CLIENTES YA REGISTRADOS:
${listaClientes}

TAREAS ABIERTAS ACTUALES (para detectar si la nota actualiza una de estas en vez de crear una nueva):
${listaTareas}

DOCUMENTOS PENDIENTES ACTUALES:
${listaDocs}

Responde ÚNICAMENTE con un array JSON válido. Nada de texto antes o después, nada de markdown, nada de \`\`\`.

Cada elemento del array tiene esta forma exacta:
{ "entidad": "tarea"|"cobro"|"agenda"|"documento"|"pendiente_aclarar", "accion": "crear"|"actualizar", "clienteNombre": string|null, "targetId": string|null, "campos": {}, "pregunta": string|null }

REGLAS DE DECISIÓN:
- "accion":"actualizar" SOLO es válido si "targetId" es exactamente uno de los ids que te di arriba en TAREAS ABIERTAS o DOCUMENTOS PENDIENTES. Si crees que la nota se refiere a algo existente pero no encuentras un id que coincida con confianza, usa "pendiente_aclarar" en vez de inventar un targetId — nunca inventes un id.
- Ejemplo de actualizar: "Pedro ya mandó los extractos" → si en DOCUMENTOS PENDIENTES existe uno de Pedro llamado "extractos" o similar, es {"entidad":"documento","accion":"actualizar","targetId":"<ese id>","campos":{"estado":"Recibido","fechaRecibido":"${hoy}"}}. Si no existe ese documento en la lista, en vez de eso crea uno nuevo ya marcado como recibido: {"entidad":"documento","accion":"crear","campos":{"nombreDocumento":"Extractos","estado":"Recibido","fechaRecibido":"${hoy}"}}.
- Ejemplo de completar tarea: "Terminé la conciliación de ABC" → busca en TAREAS ABIERTAS una de ABC relacionada con conciliación. Si la encuentras, {"entidad":"tarea","accion":"actualizar","targetId":"<id>","campos":{"estado":"Completada"}}. Si no la encuentras con confianza razonable, usa pendiente_aclarar preguntando si se refiere a una tarea existente o si debe crear una nueva marcada como completada.
- "clienteNombre": si la nota menciona un nombre que coincide (exacto o parcial, ej. solo nombre de pila) con uno de CLIENTES YA REGISTRADOS, usa el nombre completo tal como está registrado. Si menciona un nombre de persona que NO está en la lista, de todas formas ponlo en "clienteNombre" — el sistema creará automáticamente un registro mínimo con ese nombre; no necesitas pedir permiso para eso, es comportamiento esperado.
- NUNCA inventes valores, fechas, ni el significado de referencias vagas. Si la nota dice algo como "revisar lo de Andrés" sin especificar qué, o "también cobrarle" sin decir a quién con claridad, responde con "pendiente_aclarar" y una "pregunta" concreta y corta. No adivines.
- Fechas relativas ("mañana", "el jueves", "en 8 días", "fin de mes", "la próxima semana", "pasado mañana") conviértelas a fecha ISO YYYY-MM-DD usando hoy como referencia. "Este <día>" o "el <día>" sin más contexto significa la próxima ocurrencia de ese día a partir de hoy (hoy incluido si hoy es ese día y la nota implica algo para hoy).
- Dinero: convierte cualquier formato ("$900.000", "900000", "900 mil", "900k", "1.2 millones") a un número entero plano en "valor". Si el monto es genuinamente ambiguo (ej. solo dice "mil" sin nada más), usa pendiente_aclarar.
- Para "tarea" crear, campos admite: titulo (obligatorio), descripcion, prioridad ("Crítica"|"Alta"|"Media"|"Baja", por defecto "Media"), fechaLimite (YYYY-MM-DD o null).
- Para "tarea" actualizar, campos normalmente solo trae estado (ej. "Completada"), o lo que corresponda cambiar.
- Para "cobro" (siempre accion "crear", no se actualizan cobros desde nota), campos admite: concepto, valor (número), fechaEsperada (YYYY-MM-DD o null).
- Para "agenda" crear, campos admite: titulo (obligatorio), tipo (ej. "Reunión","Llamada","Visita"), fecha (YYYY-MM-DD, obligatorio), hora (HH:MM 24h o null).
- Para "documento" crear, campos admite: nombreDocumento (obligatorio), estado ("Solicitado" o "Recibido" si ya llegó), fechaRecibido (si aplica). Para "documento" actualizar, campos admite: estado, fechaRecibido.
- Para "pendiente_aclarar", deja "campos" como {} y usa "pregunta" para explicar exactamente qué falta.
- Una sola nota puede generar varias acciones para el mismo o distintos clientes — inclúyelas todas en el array, cada una con su propio "clienteNombre" correcto (no mezcles clientes entre sí).
- Si la nota no contiene nada accionable, responde con un array vacío [].
- No agregues comentarios ni texto fuera del array JSON.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
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
    let acciones;
    try {
      const cleaned = textBlock.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
      acciones = JSON.parse(cleaned);
    } catch {
      return Response.json({ error: "La respuesta no vino en el formato esperado. Intenta de nuevo." }, { status: 502 });
    }
    if (!Array.isArray(acciones)) acciones = [];

    // Red de seguridad: nunca dejar pasar una "actualizar" con un targetId que no
    // esté en el contexto que le dimos — evita que el modelo invente un id.
    const idsValidos = new Set([...tareasAbiertas.map((t) => t.id), ...documentosPendientes.map((d) => d.id)]);
    acciones = acciones.map((a) => {
      if (a.accion === "actualizar" && !idsValidos.has(a.targetId)) {
        return { entidad: "pendiente_aclarar", accion: "crear", clienteNombre: a.clienteNombre || null, targetId: null, campos: {}, pregunta: `No encontré con certeza a qué se refiere: "${a.campos?.titulo || a.campos?.nombreDocumento || texto.slice(0, 60)}". Revísalo manualmente.` };
      }
      return a;
    });

    return Response.json({ acciones });
  } catch (e) {
    return Response.json({ error: e?.message || "Error inesperado procesando la nota." }, { status: 500 });
  }
}
