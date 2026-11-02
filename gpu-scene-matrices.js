// The CAD renderer owns scene transforms. Its mutation token must change on
// source transforms or hierarchy changes other than spatial detach/reattach.
// Newly attached spatial roots must updateWorldMatrix(true,true) before draw.
const equal=(a,b)=>a?.length===b.length&&a.every((value,i)=>value===b[i]);

export class SceneMatrixCache {
  constructor(){this.token=null;this.scene=null;this.refreshes=0;this.reuses=0;}
  clear(){this.token=null;this.scene=null;}
  render(renderer,scene,camera,token){
    // Respect a caller that explicitly manages a scene's world matrices.
    if(!token||scene.matrixWorldAutoUpdate===false)return renderer.render(scene,camera);
    const signature=[...token,scene.position.x,scene.position.y,scene.position.z,scene.quaternion.x,scene.quaternion.y,scene.quaternion.z,scene.quaternion.w,scene.scale.x,scene.scale.y,scene.scale.z];
    if(this.scene!==scene||!equal(this.token,signature)){
      scene.updateMatrixWorld(true);this.scene=scene;this.token=signature;this.refreshes++;
    }else this.reuses++;
    const previous=scene.matrixWorldAutoUpdate;scene.matrixWorldAutoUpdate=false;
    try{return renderer.render(scene,camera);}
    catch(error){this.clear();throw error;}
    finally{scene.matrixWorldAutoUpdate=previous;}
  }
}
