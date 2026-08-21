export async function POST(request) {
  try {
    const { texto, contexto, historialChat } = await request.json();
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
    const preferencias = (contexto?.preferencias || "").trim();
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
    const bloquePreferencias = preferencias
      ? `\nPREFERENCIAS Y FORMA DE TRABAJAR DE CAROLINA (úsalas para decidir con más confianza y hacer MENOS preguntas):\n${preferencias}\n`
      : "";
    const bloqueChat = (historialChat && historialChat.length)
      ? `\nESTA NOTA YA TIENE UNA CONVERSACIÓN DE ACLARACIÓN EN CURSO. Aquí está el hilo completo hasta ahora (en orden):\n${historialChat.map((m) => `${m.rol === "sistema" ? "CARO CONTROL" : "CAROLINA"}: ${m.contenido}`).join("\n")}\n\nUsa este hilo para decidir. NO vuelvas a preguntar algo que Carolina ya respondió ahí. Si con esto ya tienes lo suficiente para ejecutar, hazlo. Si sigue faltando algo realmente bloqueante (y solo eso), haz UNA pregunta más.\n`
      : "";

    const systemPrompt = `Eres el motor de lenguaje natural de Caro Control, el sistema personal de una contadora independiente en Colombia. Carolina escribe rápido, con frases cortas, abreviadas o incompletas — "Pedro bancos", "Natación", "IVA María" — y tu trabajo es interpretar eso con el contexto disponible y ACTUAR, no pedirle que reformule.

Hoy es ${diaSemana}, ${hoy} (formato YYYY-MM-DD).

REGLA CENTRAL — ejecutar antes que preguntar:
- Si puedes decidir razonablemente con el contexto que tienes (clientes conocidos, tareas abiertas, preferencias de Carolina), EJECUTA. No preguntes para confirmar algo que ya es razonablemente claro.
- Si falta un dato SECUNDARIO (hora, fecha exacta, prioridad, descripción detallada, talla, presupuesto, etc.) que no impide saber QUÉ acción tomar, EJECUTA de todas formas dejando ese campo en null / sin especificar. Nunca preguntes por esto.
- Si falta el dato que determina QUÉ TIPO de acción es (ej. "cancelar lo de Juan" sin decir qué — tarea, cita, cobro, obligación — o "revisar lo de Andrés" sin decir qué), eso SÍ es bloqueante: en ese caso, y solo en ese caso, usa "pendiente_aclarar".
- NUNCA generes más de UN elemento "pendiente_aclarar" por respuesta, incluso si notas varias ambigüedades. Elige la que más bloquea, resuélvela primero; las demás ambigüedades menores, si no son bloqueantes, simplemente no las menciones y ejecuta con lo que tengas.
${bloqueChat}
CLIENTES YA REGISTRADOS:
${listaClientes}

TAREAS ABIERTAS ACTUALES:
${listaTareas}

DOCUMENTOS PENDIENTES ACTUALES:
${listaDocs}
${bloquePreferencias}
Responde ÚNICAMENTE con un array JSON válido. Nada de texto antes o después, nada de markdown, nada de \`\`\`.

Cada elemento del array tiene esta forma exacta:
{ "entidad": "tarea"|"cobro"|"agenda"|"documento"|"pendiente_aclarar", "accion": "crear"|"actualizar", "clienteNombre": string|null, "targetId": string|null, "campos": {}, "pregunta": string|null }

REGLAS ADICIONALES:
- "accion":"actualizar" SOLO es válido si "targetId" es exactamente uno de los ids que te di en TAREAS ABIERTAS o DOCUMENTOS PENDIENTES. Si crees que la nota se refiere a algo existente pero no hay un id que coincida con confianza razonable, no inventes el id — trátalo como una acción nueva (crear) en vez de forzar una actualización incierta, salvo que la ambigüedad sea tan grande que amerite la única pregunta de esta nota.
- "clienteNombre": si coincide (exacto o parcial) con un cliente ya registrado, usa el nombre completo tal como está. Si es un nombre nuevo, ponlo igual — el sistema lo crea automáticamente, no preguntes permiso para eso.
- Dinero: convierte cualquier formato ("$900.000", "900000", "900 mil", "900k", "1.2 millones") a un número entero plano en "valor".
- Fechas relativas ("mañana", "el jueves", "en 8 días", "fin de mes") conviértelas a YYYY-MM-DD usando hoy como referencia.
- Para "tarea" crear: campos admite titulo (obligatorio), descripcion, prioridad ("Crítica"|"Alta"|"Media"|"Baja", por defecto "Media"), fechaLimite (o null si no se sabe — no es motivo de pregunta).
- Para "tarea" actualizar: normalmente solo trae estado.
- Para "cobro" (siempre "crear"): concepto, valor, fechaEsperada (o null).
- Para "agenda" crear: titulo (obligatorio), tipo, fecha (YYYY-MM-DD — si genuinamente no hay ninguna pista de cuándo, usa pendiente_aclarar solo si eso es lo único que falta), hora (o null si no se sabe — no es motivo de pregunta).
- Para "documento": nombreDocumento, estado ("Solicitado" o "Recibido"), fechaRecibido si aplica.
- Si la nota no contiene nada accionable, responde [].
- No agregues texto fuera del array JSON.`;

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

    const idsValidos = new Set([...tareasAbiertas.map((t) => t.id), ...documentosPendientes.map((d) => d.id)]);
    let vistaPendienteAclarar = false;
    acciones = acciones.filter((a) => {
      if (a.accion === "actualizar" && !idsValidos.has(a.targetId)) {
        a.accion = "crear";
        a.targetId = null;
      }
      return true;
    });
    // Solo se permite UNA pendiente_aclarar por respuesta — si el modelo generó
    // varias por error, nos quedamos con la primera y ejecutamos el resto.
    acciones = acciones.filter((a) => {
      if (a.entidad === "pendiente_aclarar") {
        if (vistaPendienteAclarar) return false;
        vistaPendienteAclarar = true;
      }
      return true;
    });

    return Response.json({ acciones });
  } catch (e) {
    return Response.json({ error: e?.message || "Error inesperado procesando la nota." }, { status: 500 });
  }
}
