export async function runIndependently<T>(tasks: Array<() => Promise<T>>): Promise<Array<{ok:true;value:T}|{ok:false;error:string}>> {
  const out:Array<{ok:true;value:T}|{ok:false;error:string}>=[];
  for (const task of tasks) {
    try { out.push({ok:true,value:await task()}); }
    catch (e) { out.push({ok:false,error:e instanceof Error?e.message:String(e)}); }
  }
  return out;
}
