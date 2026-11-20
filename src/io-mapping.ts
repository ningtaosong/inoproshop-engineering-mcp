import {canonical,digest} from './storage.js';
import {DomainError,type Reply} from './contracts.js';
import {jsonBytes} from './native-output.js';

export function ioMappingPage(raw:Reply,args:any,origin={kind:'ide',inventoryOperationId:raw.operationId}) : Reply {
  if(raw.status!=='succeeded')return raw;
  const {channels,device,rootDevice,connector,coverage,diskHash,...rest}=raw.data as any;
  if(rootDevice.type!==4102||rootDevice.id!=='10f4 0002'||rootDevice.deviceDescriptionVersion!=='3.5.11.11'||
      device.type!==40600||device.id!=='10F4 0600'||device.deviceDescriptionVersion!=='00.00.00.20'||
      connector.id!==2||connector.interface!=='Common.inovance2'||connector.ownerGuid!==device.guid||
      canonical(device.path.slice(0,-1))!==canonical(rootDevice.path)||args.deviceId&&device.guid!==args.deviceId.toLowerCase()||
      !Array.isArray(channels)||coverage.observed!==channels.length)throw Error('I/O scope or inventory mismatch');
  const version=digest(canonical({scheme:'io-host-parameters-v1',projectId:args.projectId,diskHash,device,rootDevice,connector,coverage,channels}));
  if(args.expectedVersion&&args.expectedVersion!==version)throw new DomainError('unknown','IO_INVENTORY_CHANGED','原始采集证据与已发布版本不一致');
  const rows=args.detail?channels.filter(r=>canonical(r.channelKey)===canonical(args.detail)):channels;
  if(args.detail&&(rows.length!==1||rows[0].identityStatus!=='unique-in-view'))
    throw new DomainError('conflict','IO_CHANNEL_NOT_UNIQUE','指定通道在原清单中缺失或身份不唯一');
  const offset=args.offset, chosen:any[]=[];
  for(const row of rows.slice(offset,offset+args.limit)){
    if(jsonBytes([...chosen,row])>10800){
      if(!chosen.length)throw new DomainError('unsupported','IO_CHANNEL_TOO_LARGE','单项完整证据超过响应预算');
      break;
    }
    chosen.push(row);
  }
  const next=offset+chosen.length;
  const data={...rest,diskHash,version,device,rootDevice,connector,coverage,channels:chosen,readOrigin:origin,
    page:{offset,limit:args.limit,returned:chosen.length,observed:rows.length,hasMore:next<rows.length,nextOffset:next<rows.length?next:null}};
  if(jsonBytes(data)>14500)throw new DomainError('unsupported','IO_COVERAGE_TOO_LARGE','范围或缺口记录超过返回预算');
  return {...raw,data};
}
