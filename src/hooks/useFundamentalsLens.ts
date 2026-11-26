import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Explanation, LensPayload } from "@/lib/lens/types";
const cache = new Map<string, { at:number; data:LensPayload }>();
const pending = new Map<string, Promise<LensPayload>>();
async function request(symbol:string, refresh:boolean) {
  const key=symbol+(refresh?":refresh":"");
  if(pending.has(key)) return pending.get(key)!;
  const p=(async()=>{
    const {data,error}=await supabase.functions.invoke("fundamentals-lens",{body:{symbol,refresh}});
    if(error || data?.error) throw new Error(data?.error || error?.message || "Could not load company");
    if (!cache.has(symbol) || Date.parse(cache.get(symbol)!.data.computedAt) <= Date.parse(data.computedAt)) cache.set(symbol,{at:Date.now(),data}); if(cache.size>30) cache.delete(cache.keys().next().value!);
    return data as LensPayload;
  })().finally(()=>pending.delete(key));
  pending.set(key,p); return p;
}
export function useFundamentalsLens(symbol:string|null) {
  const [data,setData]=useState<LensPayload|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const seq=useRef(0);
  const load=useCallback(async(sym:string,refresh=false)=>{
    const id=++seq.current; setError(null); setLoading(true);
    const hit=cache.get(sym);
    if(!refresh && hit && Date.now()-hit.at<300000){setData(hit.data);setLoading(false);return;}
    setData(d=>d?.symbol===sym?d:null);
    try {const next=await request(sym,refresh);if(id===seq.current)setData(next);}
    catch(e){if(id===seq.current)setError(e instanceof Error?e.message:"Could not load company");}
    finally{if(id===seq.current)setLoading(false);}
  },[]);
  useEffect(()=>{if(symbol)void load(symbol);else{setData(null);setError(null);setLoading(false);}return()=>{++seq.current;};},[symbol,load]);
  return {data:data?.symbol===symbol?data:null,loading,error,refresh:()=>symbol&&load(symbol,true)};
}
const explainCache=new Map<string,Explanation>();
export function useLensExplanation(symbol:string,conceptId:string,version="") {
  const key=symbol+":"+conceptId+":"+version;
  const [exp,setExp]=useState<Explanation|null>(null),[loading,setLoading]=useState(false);
  const seq=useRef(0);
  useEffect(()=>{++seq.current;setExp(explainCache.get(key)??null);setLoading(false);return()=>{++seq.current;};},[key]);
  const run=useCallback(async()=>{const id=++seq.current;setLoading(true);
    try {const {data,error}=await supabase.functions.invoke("fundamentals-lens",{body:{action:"explain",symbol,conceptId}});
      if(error||data?.error)throw new Error(data?.error||error?.message);
      if(id!==seq.current)return;
      explainCache.set(key,data);if(explainCache.size>100)explainCache.delete(explainCache.keys().next().value!);setExp(data);
    }catch(e){if(id===seq.current)setExp({sentences:[],missing:[],source:"template",error:e instanceof Error?e.message:"Explanation unavailable"});}
    finally{if(id===seq.current)setLoading(false);}
  },[symbol,conceptId,key]);
  return{exp,loading,run};
}
