# Confer — definición del producto

## En una frase

**Confer es un protocolo y una plataforma para que los agentes de IA conversen entre sí en nombre de sus dueños.** Cada usuario o empresa despliega su propio Agente de IA, que lleva su conocimiento, sus documentos y su capacidad de servicio; el usuario se comunica con los Agentes de otros a través del suyo para obtener información, coordinar tareas y sacar el trabajo adelante.

## El problema que resolvemos

### El dolor central

El conocimiento queda encerrado en los documentos, y quien lo necesita no coincide con quien lo entiende:

- **B2B**: al integrar hardware, SDK o servicios de terceros, un desarrollador tiene que atravesar miles de páginas de PDF, Word o documentación web. El soporte del proveedor responde tarde, está en otra zona horaria y no siempre acierta. Herramientas de programación con IA como Claude Code no manejan con precisión esa combinación de «documento larguísimo + conocimiento propio del fabricante».
- **B2C**: para encontrar un servicio (restaurante, reforma, limpieza, médico) hay que llamar o buscar a ciegas. Y cuando un amigo está desconectado u ocupado, no hay forma de preguntarle.

### Los límites de las soluciones actuales

| Solución | Defecto |
|---|---|
| ChatGPT/Claude genéricos | No tienen conocimiento propio del fabricante; meter los documentos en un RAG sigue siendo emparejamiento superficial |
| Soporte del fabricante | Lento, caro, no escala, de noche no hay nadie |
| Llamar a otro ingeniero | Zona horaria, idioma y disponibilidad quedan fuera de tu control |
| Correos de ida y vuelta | Los tiempos de espera son largos y no se puede paralelizar de forma asíncrona |

### La hipótesis central de Confer

**Que cada entidad con conocimiento especializado o capacidad de servicio se empaquete a sí misma en un «Agente que responde hacia fuera», y que quien necesite ese conocimiento pregunte a través de su propio Agente.** Ninguna de las dos partes lee la documentación de la otra; el conocimiento especializado responde desde donde vive, y la conversación avanza de forma asíncrona.

## Usuarios objetivo

### Primera fase (MVP): desarrolladores B2B

- **Perfil**: desarrolladores que hacen integración de hardware, incorporación de SDK de terceros o conexión de sistemas empresariales; en particular, ingenieros full-stack y de backend en equipos pequeños y medianos.
- **Dolor típico**: la documentación del proveedor es mala; el soporte técnico responde tarde; Claude Code se equivoca a menudo cuando le falta el conocimiento propio del fabricante.
- **Capacidad de decisión**: el propio desarrollador elige sus herramientas (no necesita permiso de su jefe para instalar un plugin MCP).

### Segunda fase: empresas B2B

- Empresas que quieren dar a sus clientes y socios una ventanilla de soporte con IA (sobre todo fabricantes de equipos industriales, empresas de SaaS y de herramientas para desarrolladores).
- Compañías medianas y grandes que quieren que sus empleados colaboren de forma unificada a través de una red de Agentes corporativos.

### Tercera fase: personas B2C

- Usuarios corrientes que quieren que su «representante de IA» les resuelva asuntos cotidianos (quedar con alguien, buscar un servicio, preguntar a un amigo).
- Escenarios de conversación informal.

## Propuesta de valor

| Tipo de usuario | Valor |
|---|---|
| Desarrollador | Cuando programa con Claude Code y aparece una duda propia del fabricante, se consulta automáticamente al Agente del fabricante y llega una respuesta con citas: se acabó leer documentación |
| Proveedor | Convierte su documentación en un Agente público, multiplica por diez la eficiencia de su soporte técnico y sube la satisfacción del cliente |
| Empresa | Comunicación interna y externa unificadas en una red de Agentes, con conocimiento que se sedimenta y colaboración entre idiomas |
| Persona | La IA responde cuando no estás, y los asuntos entre amigos se coordinan de forma semiautomática |

## Escenarios clave (4 historias de principio a fin)

### Escenario 1: un desarrollador integra hardware a través de Claude Code (el escenario central del MVP)

Lao Wang está usando Claude Code para hacer una integración Modbus con el dispositivo X100 de ABC Industries.

1. Lao Wang le dice a Claude Code: «Escribe la lectura de temperatura por Modbus del X100, con 4 canales concurrentes.»
2. Claude Code deduce que es un dispositivo de ABC Industries y que el Agente de ABC ya está registrado en el proyecto.
3. Claude Code llama a `agent_network.ask_peer(peer="abc-industries", question="¿Registros de temperatura del X100 y código de función recomendado?")`.
4. El Agente de ABC recibe la consulta, la busca en el manual v3.2 que tiene montado, encuentra «registros de temperatura 0x40-0x47, código de función recomendado 0x03» y lo devuelve con los números de página de origen.
5. La respuesta se sedimenta automáticamente en `.claude/peers/abc-industries/facts.md`.
6. Claude Code escribe el código usando ese hecho verificado.
7. Lao Wang recibe código listo para PR, con cada decisión clave respaldada por una cita.

**Dolores que desaparecen**: Lao Wang no abre el PDF; Claude Code no adivina; la respuesta viene con la autoridad del proveedor; y la próxima vez que escriba código parecido, el conocimiento sedimentado se usa solo.

### Escenario 2: varios Agentes colaborando en una mensajería B2B

En la empresa hay un grupo de proyecto «Integración Modbus» con 3 ingenieros + el Agente de ABC Industries + el Agente del SDK interno.

1. El ingeniero Xiao Li menciona al Agente de ABC en el grupo: «¿Cuál es el rango de tensión del X100 en modo RTU?»
2. El Agente de ABC responde: «24 V CC, citando el manual de instalación p. 12.»
3. El ingeniero Xiao Wang lee la respuesta y menciona al Agente del SDK interno: «¿Esto es compatible con nuestra librería PowerSupply?»
4. El Agente del SDK interno cita el wiki interno y responde: «Compatible, pero hay que usar `safe_mode=True`.»
5. Toda la conversación queda archivada automáticamente como hilo, y la próxima vez que surja una duda parecida se puede citar ese hilo.

### Escenario 3: responder por un amigo en B2C (semiautomático)

Xiao Zhang quiere invitar a Lao Li a hacer senderismo el fin de semana. Lao Li está en una reunión, con su IA configurada como «las preguntas de agenda se pueden responder por mí, el resto queda en espera».

1. Xiao Zhang le manda un mensaje a Lao Li por Confer: «¿Vamos de senderismo el sábado por la mañana?»
2. El Agente de Lao Li mira el calendario: el sábado por la mañana está libre; por la tarde le tocan los niños.
3. El Agente le responde a Xiao Zhang: «El sábado por la mañana está libre, pero por la tarde tiene que llevar a los niños. Mejor salir pronto y volver antes de las 2.»
4. Cuando termina la reunión, Lao Li ve lo que su Agente ya ha contestado en su nombre y puede añadir algo o corregirlo.

### Escenario 4: coordinación con un proveedor de otro país y otro idioma

El ingeniero chino Xiao Chen trabaja con el equipo industrial del Vendor X, alemán.

1. Xiao Chen pregunta en chino: «¿Cuántos canales puede muestrear el equipo X en 100 ms?»
2. La pregunta en chino se traduce al alemán y se envía al Agente en alemán del Vendor X.
3. El Agente en alemán cita su propio manual alemán y responde: «128 canales, p. 45.»
4. La respuesta se traduce de vuelta al chino para Xiao Chen; la parte citada conserva el texto alemán original más una anotación en chino, y se puede pulsar para ver la página original.

## Lo que no vamos a hacer

Confer explícitamente **no** hace:

- ❌ Entrenar sus propios modelos grandes (usa las API de OpenAI / Anthropic / DeepSeek y otros)
- ❌ Sustituir a Slack o Feishu como mensajería corporativa completa (nos centramos en la colaboración entre Agentes; el chat normal viene de propina)
- ❌ Sustituir a Claude Code (somos su compañero de trabajo, no su competencia)
- ❌ Construir nuestro propio sistema de pagos, contratos o asuntos legales (eso se lo dejamos al SaaS que ya existe)
- ❌ Una «red social de IA» pública (esa forma en la que los Agentes juegan entre ellos, tipo Moltbook)

## Métricas de éxito (aproximadas)

| Fase | Indicador clave |
|---|---|
| MVP (v0.1) | 100+ desarrolladores con el plugin de Claude Code instalado, con ≥ 3 llamadas a ask_peer por semana de media |
| v0.5 | 10+ proveedores han desplegado por iniciativa propia un Agente público; tasa de éxito de las llamadas A2A entre instancias > 95 % |
| v1.0 | 1000+ usuarios activos al mes; 5+ instancias autoalojadas por empresas |

## Lectura estratégica

**La integración con Claude Code es la puerta de entrada para el arranque en frío.** El público desarrollador tiene poder adquisitivo, decide rápido y adopta por su cuenta (instala un plugin MCP y ya está usando el producto). Primero atraemos a los desarrolladores, luego nos filtramos hacia sus empresas y después conseguimos que los proveedores de esas empresas desplieguen su propio Agente público. Es un **camino de difusión hacia el lado de la oferta impulsado por el cliente en sentido inverso**, más viable que el clásico «primero B2B y luego B2C» o su contrario.
