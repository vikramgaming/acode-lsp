function contoh(): [string, () => string] {
    const hello = "hai"
    const fn = () => hello
    
    return [hello, fn];
}

const [] = contoh()