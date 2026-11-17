import type {CarViewState} from './coastal-car';

export function carFeedback(state:CarViewState):{status:string;condition:string}{
 const condition=state.recovering?'车身正在回稳 · 动力未受损':'动力正常 · 无故障降速';
 if(state.blockage==='water')return{condition:(state.waterDepth??0)>.35?'车辆涉水停驶':'动力正常 · 前方水深',status:(state.waterDepth??0)>.35?'车辆已进入深水 · 按 G 救援回岸上':'前方是深水 · 请倒车回岸，或按 G 救援'};
 if(state.overturned)return{condition,status:'车辆侧翻 · 可下车查看，或使用道路救援'};
 if(!state.grounded)return{condition,status:'车轮离地 · 松开油门，等待落稳'};
 if(state.blocked)return{condition,status:state.blockage==='trapped'?'车辆卡住 · 使用道路救援':state.blockage==='step'?'道路台阶或落差过大 · 请沿坡道行驶':state.blockage==='rear'?'后方受阻 · 向前调整或使用道路救援':'前方受阻 · 倒车脱离后再加速，卡住可用道路救援'};
 if(state.recovering)return{condition,status:'车身回稳中 · 轻踩油门或倒车脱离，落稳后恢复正常驾驶'};
 return{condition,status:state.braking?'正在制动 · 停稳后可向相反方向起步':state.speed<-.2?'正在倒车 · 白色倒车灯亮起，留意车后':'沿着海岸公路，去下一个街区。'};
}
