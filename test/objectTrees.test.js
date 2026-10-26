'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../data/object-trees');
const tree=require('../data/object-trees/ma3_tree.json'),props=require('../data/object-trees/ma3_props.json');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const flatten=a=>a.flatMap(x=>[x,...flatten(x.k||[])]);
test('MA3 tree keeps fourteen preset pools and separate live/edit/PSR patch branches',()=>{
 const nodes=flatten(tree);assert.equal(nodes.filter(x=>x.c==='Presets').length,14);
 assert.deepEqual(nodes.filter(x=>['LivePatch','Patch','PsrPatch'].includes(x.n||x.c)&&x.c==='Patch').map(x=>x.n||x.c).sort(),['LivePatch','Patch','PsrPatch']);
});
test('MA3 nodes expose absolute Lua and CLI addresses, including executor index differences',()=>{
 for(const n of flatten(tree)){assert.ok(props.nodes[n.p],n.p);assert.equal(n.l,props.nodes[n.p].lua);assert.match(n.l,/^Root\(\)(?:\[\d+\])+$/);if(n.a)assert.match(n.a,/^Root \d+(?:\.\d+)*$/);}
 const exec=flatten(tree).find(x=>x.c==='Executor');assert.ok(exec);const cli=Number(exec.a.split('.').pop()),lua=Number(exec.l.match(/\[(\d+)\]$/)[1]);assert.notEqual(cli,lua,'executor visible number is not its Lua index');
});
test('the standalone embedded blocks equal the bundled JSON, including unchanged MA2 data',()=>{
 for(const [id,file]of [['d-ma3','ma3_tree.json'],['p-ma3','ma3_props.json'],['r-ma3','ma3_references.json'],['d-ma2','ma2_tree.json'],['p-ma2','ma2_props.json'],['a-ma2','ma2_attributes.json']]){
  const m=html.match(new RegExp('<script type="application/json" id="'+id+'">([\\s\\S]*?)</script>'));assert.ok(m,id);assert.deepEqual(JSON.parse(m[1]),JSON.parse(fs.readFileSync(path.join(base,file))),id);
 }
});
test('new generator and timecode schemas reach offline property completion',()=>{
 const p=require('../lib/props');assert.ok(p.ma3Props('Random').some(x=>x.name==='GRIDSELECTION'));assert.ok(p.ma3Props('Bitmap').some(x=>x.name==='CONFIGHANDLE'));assert.ok(p.ma3Props('CmdEvent').length>15);
});
test('factory references include attributes, gels, hardkeys and colors without station identifiers',()=>{
 const refs=require('../data/object-trees/ma3_references.json');assert.ok(refs.attributes.some(x=>x.name==='P3'));assert.ok(refs.gels.some(x=>x.name==='White'));assert.ok(refs.hardkeys.length>1000);assert.ok(refs.colors.some(x=>x.name==='Disabled'));
 for(const file of ['ma3_tree.json','ma3_props.json','ma3_references.json'])assert.doesNotMatch(fs.readFileSync(path.join(base,file),'utf8'),/[A-Z]:[\\/]Users[\\/]/i,file);
});
