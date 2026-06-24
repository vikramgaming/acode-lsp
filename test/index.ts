function contoh(str: string): [string, () => string] {
    const hello = str
    const fn = () => hello
    
    return [hello, fn];
}
const [] = contoh()
function example(args: any): void {
    console.log(args)
}