// Controlled Node observer fixture only, never imports/launches the native IDE.
const [mode='normal']=process.argv.slice(2);
process.stdin.on('error',()=>{});
process.stdin.on('data',()=>{});
process.stdin.on('end',()=>{
 if(mode==='late')setTimeout(()=>{process.exitCode=0;},200);
 else if(mode==='nonzero')process.exitCode=7;
});
process.stdin.resume();
