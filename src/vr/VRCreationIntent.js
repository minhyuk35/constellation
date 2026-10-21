import { Vector3, Quaternion } from 'three';

// Creation requires a deliberate open→fist sequence in the raised workspace.
// Resting fists, entering tracking with a fist and raising an already closed
// hand do not arm creation. Picking remains independent of this gate.
export class VRCreationIntent {
  constructor(){this.local=new Vector3();this.inverse=new Quaternion();this.reset();}
  reset(){this.armed=false;this.openAt=null;}
  workspace(palm,headPosition,headQuaternion) {
    this.local.copy(palm).sub(headPosition);
    if(this.local.length()>1.15||palm.y<headPosition.y-.55)return false;
    this.local.applyQuaternion(this.inverse.copy(headQuaternion).invert());
    return this.local.z<-.12 && Math.abs(this.local.x)<Math.min(.85,-this.local.z*1.5+.05) && Math.abs(this.local.y)<-this.local.z*.95+.08;
  }
  update(gesture,inside,now) {
    if(!inside){this.reset();return false;}
    if(gesture==='open') {
      this.openAt??=now;if(now-this.openAt>=180)this.armed=true;
    } else this.openAt=null;
    return this.armed;
  }
  consume(){this.reset();}
}
