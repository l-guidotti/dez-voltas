// Synthetic provider response: the test chooses the types; production still calls Gemini.
export function blueprintResponse(input){
 return {summary:'Bloco progressivo pela recuperação.',feasibility:'Reavaliar a viabilidade até a prova.',warnings:['Projeções condicionadas ao próximo fechamento.'],phases:input.phases.map(()=>({title:'Preparação',focus:'Continuidade e recuperação.'})),weeks:input.sessionBlueprint.weeks.map((w,i)=>({focus:'Progredir conforme o orçamento e a recuperação.',sessions:w.slots.map(s=>({slotId:s.id,type:s.allowedTypes[i%s.allowedTypes.length],title:s.role==='quality'?'Qualidade controlada':'Corrida de base',purpose:'Adaptação ao objetivo com recuperação.',instructions:'Respeite a percepção de esforço e interrompa com dor.'}))}))};
}
