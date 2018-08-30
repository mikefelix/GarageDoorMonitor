#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>
#include <string.h>

int main(int argc, char *argv[])
{
    char* level;
    if (argc > 1){
        level = argv[1];
    }
    else {
        level = "3";
    }


    char cmd[20];
    snprintf(cmd, sizeof(cmd), "%s%s", "./start.sh ", level);

    setuid(0);
    printf(cmd);
    printf("\n");
    system(cmd);
    return 0;
}
