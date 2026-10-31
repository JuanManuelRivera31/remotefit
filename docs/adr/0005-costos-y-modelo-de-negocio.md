# ADR 0005 — Costos de IA y modelo de negocio

- **Estado:** Aceptado
- **Fecha:** 2026-10-31
- **Sustituye a:** ADR 0003 (LLM detrás de una interfaz, con control de costos)
- **Relacionado con:** ADR 0002 (fuentes), ADR 0004 (taxonomía y métrica), docs/06-diseno-v0.1.md, docs/07-aprendizajes-career-ops.md

## Contexto

RemoteFit usa un LLM para clasificar la elegibilidad de ofertas remotas. Un riesgo central es económico:

- El usuario objetivo (desarrollador latinoamericano buscando empleo) tiene baja capacidad de pago.
- En la prueba con career-ops, el uso de IA fue alto porque el agente era el motor de todo el flujo.
- El autor es estudiante, sin ingresos estables, y no puede asumir costos variables sin techo.

Recursos disponibles:
- Capa gratuita de la API de Gemini (Google AI Studio) para modelos Flash livianos, con límites diarios por proyecto. No requiere suscripción. En la capa gratuita, Google puede usar entradas y salidas para mejorar sus productos.
- Dos suscripciones a Google AI Plus. No incluyen créditos de Google Cloud ni de la API de Gemini (esos créditos son de AI Pro y Ultra). Sí incluyen unidades de cómputo en Google Colab, útiles para experimentos de ML (por ejemplo, entrenar un clasificador destilado).
- Plan Pro de Claude (solo para desarrollo con Claude Code; no se usa en producción).

## Decisión

### 1. Arquitectura de costo: por oferta, no por usuario
- Cada oferta se clasifica **una sola vez** (clave: hash de contenido + versión de prompt + modelo) y el resultado se comparte entre todos los usuarios.
- "Aplicable" se calcula **en código, sin LLM**, cruzando los atributos extraídos (`countries`, `excludedCountries`, etiqueta) con el país del usuario.
- El puntaje de encaje con el perfil se calcula con reglas o embeddings, no con llamadas al LLM por usuario. Excepción futura solo si una evaluación demuestra que vale la pena.
- Cascada obligatoria: prefiltro por reglas → modelo gratuito → si el modelo duda, la oferta queda como `unclear` (nunca se marca como aplicable sin evidencia).

### 2. Proveedores
- Capa de proveedores intercambiable (Gemini, Anthropic, otros) detrás de una sola interfaz.
- **Solo capa gratuita.** En producción se usan únicamente modelos de la capa gratuita de la API de Gemini (Flash / Flash-Lite), **sin cuenta de facturación vinculada**. No se configuran proveedores de pago en el MVP.
- Entre los modelos gratuitos, el proveedor por defecto es el que mejor cumpla la métrica del ADR 0004 (precisión de aplicables ≥ 95 %, recall ≥ 80 %) en el conjunto de prueba fijo, justificado con el informe de evaluación.
- Si ningún modelo gratuito cumple la métrica: se prioriza la **precisión** sobre el recall (más ofertas quedan como `unclear`), se mejora el prompt y el prefiltro con datos, y se documenta la brecha. Pasar a un modelo de pago requiere un nuevo ADR.
- A futuro: clasificador destilado (embeddings + modelo clásico) entrenado con ofertas ya etiquetadas, usando Google Colab, para resolver casos fáciles sin LLM.

### 3. Costo cero y límites de uso
- **Gasto en dinero: USD 0.** Sin tarjeta ni facturación vinculada, no hay cobros posibles; al alcanzar un límite, la API rechaza peticiones hasta que se renueva la cuota.
- La capa gratuita tiene límites bajos por minuto (RPM/TPM) y por día (RPD), que varían por modelo y cambian con el tiempo. Se leen en Google AI Studio y se guardan en configuración, no en el código.
- **Cola con control de ritmo:** las clasificaciones pasan por una cola que respeta RPM y RPD, con reintentos con espera exponencial ante errores 429.
- **Prioridad de cola:** ofertas nuevas de empresas del directorio primero; re-verificaciones después.
- Al agotar la cuota diaria, el sistema **pausa la clasificación nueva hasta el día siguiente** y sigue sirviendo lo ya clasificado. Nunca falla en silencio: registra uso diario por modelo y alerta cerca del límite.
- Se sigue registrando tokens y costo equivalente por llamada, para saber cuánto costaría si algún día se pasa a pago.

### 4. Privacidad
- A capas gratuitas o servicios que puedan usar datos para entrenar **solo se envía texto público de ofertas**.
- **Nunca** se envían datos personales de usuarios (perfil, CV, correo) a servicios que puedan usarlos para entrenar modelos.

### 5. Modelo de negocio
- **Gratis para el desarrollador.** No se cobra al usuario que busca empleo en el MVP.
- Vías de ingreso a validar, en este orden:
  1. Resumen semanal (newsletter) de ofertas remotas verificadas para LATAM, monetizable con patrocinios.
  2. Publicación de vacantes "verificadas para LATAM" por empresas y agencias nearshore.
  3. Licenciar la clasificación de elegibilidad como API a bolsas de empleo, usando el informe de evaluación como argumento de venta.
  4. Referidos de servicios relevantes (pagos internacionales, EOR, cursos de inglés técnico), si existen programas adecuados.
- Plan premium para usuarios solo después de validar uso recurrente.

### 6. Criterios de validación y corte
- Lanzar el resumen semanal con las ofertas clasificadas.
- **Meta: ≥ 100 suscriptores en 8 semanas** desde el lanzamiento.
- Si no se alcanza: congelar el esfuerzo comercial y mantener RemoteFit como proyecto de portafolio (sin gasto recurrente).
- La búsqueda de empleo del autor tiene prioridad sobre el desarrollo de RemoteFit.

## Consecuencias

- **Positivas:** costo marginal por usuario cercano a cero; riesgo financiero nulo; la elección de modelo queda ligada a la evaluación (refuerza el diferenciador del proyecto); el proyecto aporta valor de portafolio aunque no genere ingresos.
- **Negativas:** dependencia total de una capa gratuita que Google puede cambiar; los límites diarios pueden retrasar ofertas nuevas; el modelo gratuito podría no alcanzar la métrica; el modelo de ingresos depende de construir audiencia, algo aún no probado.
- **Seguimiento:** revisar este ADR cuando cambien los precios o las capas gratuitas de los proveedores, o al cumplirse las 8 semanas de validación.

## Aclaraciones de la integración (2026-10-31)

- **Encaje en el MVP:** solo reglas deterministas. Los embeddings quedan fuera porque enviar el perfil a un servicio gratuito rompería la sección 4 de este ADR.
- **Aplicable:** además de lo indicado en la sección 1, `isApplicable` exige `workModel = remote` (ADR 0004).
- **Prioridad de cola en el MVP:** toda oferta viene del directorio, así que el orden es nuevas primero y cambiadas (nuevo `content_hash`) después. Verificar vigencia no usa el LLM.
- **Boletín:** la validación de la sección 6 ocurre después de S11; no forma parte del MVP. Guardar correos de suscriptores exige definir antes su tratamiento.
- **Redistribución:** el boletín y las demás vías de ingreso respetan el ADR 0002. Se publican título, empresa, etiqueta y enlace al original, no el texto completo, tras revisar los términos de cada ATS.
