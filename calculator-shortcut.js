// 연산자 한 글자로 숫자 계산기를 여는 단축 규칙.
//  - 명령이 없을 때(대기)만 연다. 명령 도중의 '-' 는 음수 좌표(-100,200)의 첫 글자다.
//  - 키를 누르는 즉시 여는 것은 입력창이 비어 있을 때뿐이며, '-' 는 -LAYER 같은 명령 입력의 첫 글자일 수 있어
//    숫자 객체를 골라 둔 상태에서만 즉시 연다. 그 밖에는 '-' 만 적고 Enter(입력 전체가 연산자) 했을 때 연다.
export const CALCULATOR_OPERATORS={'+':'+','-':'-','*':'*','/':'/','×':'*','÷':'/'};
export function calculatorOperator(text){return CALCULATOR_OPERATORS[String(text??'').trim()]||null;}
export function calculatorShortcut({text,mode,phase,busy=false,inputValue='',selectionCount=0,trigger='submit'}){
  const operator=calculatorOperator(text);
  if(!operator)return null;
  if(busy||mode!=='SELECT'||phase!=='idle')return null;
  if(trigger==='key'){
    if(inputValue)return null;
    if(operator==='-'&&!selectionCount)return null;
  }
  return operator;
}
