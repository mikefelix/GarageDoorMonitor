#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char *argv[])
{
    printf("argc = %d\n", argc);
    for (int i = 0; i < argc; ++i) {
        printf("argv[ %d ] = %s\n", i, argv[i]);
    }

    return 0;
}
