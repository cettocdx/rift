#!/usr/bin/env node
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'rift-composer-'));
try {
 execFileSync('xcrun',['actool',resolve(root,'packages/ios/Resources/RIFTIcon.icon'),'--compile',temp,'--platform','macosx','--minimum-deployment-target','11.0','--app-icon','RIFTIcon','--output-partial-info-plist',join(temp,'Info.plist')],{stdio:'inherit'});
 for(const target of ['packages/desktop/src-tauri/icons','src-tauri/icons']){
  const directory=resolve(root,target);mkdirSync(directory,{recursive:true});
  copyFileSync(join(temp,'RIFTIcon.icns'),join(directory,'icon.icns'));
  copyFileSync(join(temp,'Assets.car'),join(directory,'Assets.car'));
 }
} finally {rmSync(temp,{recursive:true,force:true});}
